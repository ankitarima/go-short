import type { Prisma, QRCode } from '@go-short/database';
import { AppError } from '@go-short/shared';
import { createQrSchema, listQrQuery, qrImageQuery, updateQrSchema } from '@go-short/validation';
import express, { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import { randomToken } from '../lib/crypto';
import { requireWorkspace } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { ImageError, MAX_LOGO_BYTES, sanitizeLogo } from '../qr/image';
import { assertScannable, effectiveCorrection, renderQr, type QrStyle } from '../qr/render';
import { audit } from '../services/audit';

type QrWithLink = QRCode & { link: { slug: string; domain: { hostname: string } } };

export function qrRouter(ctx: AppContext): Router {
  const r = Router({ mergeParams: true });
  const { prisma, storage } = ctx;
  const include = {
    link: { select: { slug: true, domain: { select: { hostname: true } } } },
  } as const;

  /** The URL encoded in the QR: the short URL plus a `?qr=<id>` marker so scans are counted separately. */
  const encodedUrl = (q: QrWithLink): string => {
    const host = q.link.domain.hostname;
    const scheme = host.includes(':') || host === 'localhost' ? 'http' : 'https';
    return `${scheme}://${host}/${q.link.slug}?qr=${q.id}`;
  };

  const dto = (q: QrWithLink) => ({
    id: q.id,
    name: q.name,
    linkId: q.linkId,
    campaignId: q.campaignId,
    format: q.format.toLowerCase(),
    size: q.size,
    margin: q.margin,
    errorCorrection: q.errorCorrection,
    foregroundColor: q.foregroundColor,
    backgroundColor: q.backgroundColor,
    hasLogo: q.logoPath !== null,
    url: encodedUrl(q),
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  });

  const style = (q: QrWithLink, over: { size?: number } = {}): QrStyle => ({
    size: over.size ?? q.size,
    margin: q.margin,
    errorCorrection: q.errorCorrection,
    foregroundColor: q.foregroundColor,
    backgroundColor: q.backgroundColor,
  });

  async function find(workspaceId: string, id: string): Promise<QrWithLink> {
    // Scoped by workspace: another tenant's QR id is simply "not found".
    const q = await prisma.qRCode.findFirst({ where: { id, workspaceId }, include });
    if (!q) throw new AppError('NOT_FOUND', 'QR code not found');
    return q;
  }

  async function checkCampaign(
    workspaceId: string,
    campaignId: string | null | undefined,
  ): Promise<void> {
    if (!campaignId) return;
    if (!ctx.config.FEATURE_CAMPAIGNS)
      throw new AppError('FEATURE_DISABLED', 'Campaigns are disabled');
    if (
      !(await prisma.campaign.findFirst({
        where: { id: campaignId, workspaceId },
        select: { id: true },
      }))
    ) {
      throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign not found');
    }
  }

  /** A logo key must live under this workspace's prefix and exist; anything else is "not found". */
  async function loadLogo(
    workspaceId: string,
    logoPath: string | null | undefined,
  ): Promise<Buffer | undefined> {
    if (!logoPath) return undefined;
    if (!ctx.config.FEATURE_QR_LOGOS)
      throw new AppError('FEATURE_DISABLED', 'QR logos are disabled');
    if (!logoPath.startsWith(`logos/${workspaceId}/`))
      throw new AppError('NOT_FOUND', 'Logo not found');
    const buf = await storage.get(logoPath).catch(() => null);
    if (!buf) throw new AppError('NOT_FOUND', 'Logo not found');
    return buf;
  }

  async function dropLogoIfUnused(logoPath: string | null, exceptQrId?: string): Promise<void> {
    if (!logoPath) return;
    const others = await prisma.qRCode.count({
      where: { logoPath, ...(exceptQrId ? { id: { not: exceptQrId } } : {}) },
    });
    if (others === 0)
      await storage
        .delete(logoPath)
        .catch((err) => ctx.logger.warn({ err }, 'could not delete logo file'));
  }

  function send(
    res: Response,
    rendered: { mimeType: string; body: Buffer },
    filename: string,
    download: boolean,
  ) {
    res.status(200);
    res.setHeader('Content-Type', rendered.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    // Defence in depth: even if the SVG were opened directly it cannot run script or load anything.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    );
    res.send(rendered.body);
  }

  // ---- logo upload ---------------------------------------------------------------------------
  r.post(
    '/logos',
    requireWorkspace(ctx, 'qr:write'),
    rateLimit(ctx, {
      name: 'qr-logo',
      limit: 30,
      windowSeconds: 3600,
      key: (req) => req.workspace!.id,
    }),
    express.raw({ type: ['image/png', 'image/jpeg'], limit: MAX_LOGO_BYTES }),
    async (req, res) => {
      if (!ctx.config.FEATURE_QR_LOGOS)
        throw new AppError('FEATURE_DISABLED', 'QR logos are disabled');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError(
          'UNSUPPORTED_MEDIA',
          'Send the logo as the raw request body with Content-Type image/png or image/jpeg',
        );
      }
      let png: Buffer;
      try {
        png = sanitizeLogo(req.body);
      } catch (err) {
        if (err instanceof ImageError) throw new AppError('VALIDATION_ERROR', err.message);
        throw err;
      }
      const logoPath = `logos/${req.workspace!.id}/${randomToken(18)}.png`;
      await storage.put(logoPath, png);
      res.status(201).json({ success: true, data: { logoPath, bytes: png.length } });
    },
  );

  // ---- CRUD ----------------------------------------------------------------------------------
  r.get('/', requireWorkspace(ctx, 'qr:read'), async (req, res) => {
    const q = listQrQuery.parse(req.query);
    const where: Prisma.QRCodeWhereInput = {
      workspaceId: req.workspace!.id,
      ...(q.campaignId ? { campaignId: q.campaignId } : {}),
      ...(q.linkId ? { linkId: q.linkId } : {}),
    };
    const rows = await prisma.qRCode.findMany({
      where,
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    res.json({
      success: true,
      data: page.map(dto),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    });
  });

  r.post(
    '/',
    requireWorkspace(ctx, 'qr:write'),
    rateLimit(ctx, {
      name: 'qr-create',
      limit: 60,
      windowSeconds: 60,
      key: (req) => req.workspace!.id,
    }),
    async (req, res) => {
      const input = createQrSchema.parse(req.body);
      const wsId = req.workspace!.id;
      const link = await prisma.link.findFirst({
        where: { id: input.linkId, workspaceId: wsId },
        select: { id: true, campaignId: true },
      });
      if (!link) throw new AppError('LINK_NOT_FOUND', 'Link not found');
      const campaignId = input.campaignId === undefined ? link.campaignId : input.campaignId;
      await checkCampaign(wsId, campaignId);
      const logo = await loadLogo(wsId, input.logoPath);
      const base: QrStyle = {
        size: input.size,
        margin: input.margin,
        errorCorrection: input.errorCorrection,
        foregroundColor: input.foregroundColor,
        backgroundColor: input.backgroundColor,
      };
      assertScannable(base);

      const created = await prisma.qRCode.create({
        data: {
          workspaceId: wsId,
          linkId: link.id,
          campaignId,
          name: input.name,
          format: input.format === 'svg' ? 'SVG' : 'PNG',
          size: input.size,
          margin: input.margin,
          errorCorrection: effectiveCorrection(base, Boolean(logo)),
          foregroundColor: input.foregroundColor,
          backgroundColor: input.backgroundColor,
          logoPath: logo ? input.logoPath : null,
        },
        include,
      });
      try {
        const rendered = await renderQr(encodedUrl(created), style(created), input.format, logo);
        await audit(ctx, {
          workspaceId: wsId,
          userId: req.auth!.user.id,
          action: 'QR_CREATED',
          resourceType: 'qr',
          resourceId: created.id,
          metadata: { linkId: link.id },
        });
        res.status(201).json({
          success: true,
          data: {
            ...dto(created),
            mimeType: rendered.mimeType,
            // SVG is returned as text, PNG as base64 (also available as binary from /:id/image).
            encoding: input.format === 'svg' ? 'utf8' : 'base64',
            data:
              input.format === 'svg'
                ? rendered.body.toString('utf8')
                : rendered.body.toString('base64'),
          },
        });
      } catch (err) {
        // Do not leave a QR record behind that we could not render (e.g. content too long).
        await prisma.qRCode.delete({ where: { id: created.id } }).catch(() => undefined);
        if (err instanceof AppError) throw err;
        throw new AppError('VALIDATION_ERROR', 'Could not generate a QR code with these settings');
      }
    },
  );

  r.get('/:qrId', requireWorkspace(ctx, 'qr:read'), async (req, res) => {
    res.json({
      success: true,
      data: dto(await find(req.workspace!.id, z.string().parse(req.params.qrId))),
    });
  });

  r.get('/:qrId/image', requireWorkspace(ctx, 'qr:read'), async (req, res) => {
    const q = await find(req.workspace!.id, z.string().parse(req.params.qrId));
    const o = qrImageQuery.parse(req.query);
    const format = o.format ?? (q.format === 'SVG' ? 'svg' : 'png');
    const logo = await loadLogo(q.workspaceId, q.logoPath);
    const rendered = await renderQr(encodedUrl(q), style(q, { size: o.size }), format, logo);
    send(res, rendered, `qr-${q.id}.${format}`, Boolean(o.download));
  });

  r.patch('/:qrId', requireWorkspace(ctx, 'qr:write'), async (req, res) => {
    const input = updateQrSchema.parse(req.body);
    const wsId = req.workspace!.id;
    const before = await find(wsId, z.string().parse(req.params.qrId));
    if (input.campaignId !== undefined) await checkCampaign(wsId, input.campaignId);
    const logoPath = input.logoPath === undefined ? before.logoPath : input.logoPath;
    const logo = await loadLogo(wsId, logoPath);
    const merged: QrStyle = {
      size: input.size ?? before.size,
      margin: input.margin ?? before.margin,
      errorCorrection: input.errorCorrection ?? before.errorCorrection,
      foregroundColor: input.foregroundColor ?? before.foregroundColor,
      backgroundColor: input.backgroundColor ?? before.backgroundColor,
    };
    assertScannable(merged);
    const { logoPath: _l, format, ...rest } = input;
    void _l;
    const updated = await prisma.qRCode.update({
      where: { id: before.id },
      data: {
        ...rest,
        ...(format ? { format: format === 'svg' ? ('SVG' as const) : ('PNG' as const) } : {}),
        errorCorrection: effectiveCorrection(merged, Boolean(logo)),
        logoPath: logo ? logoPath : null,
      },
      include,
    });
    if (before.logoPath && before.logoPath !== updated.logoPath)
      await dropLogoIfUnused(before.logoPath);
    await audit(ctx, {
      workspaceId: wsId,
      userId: req.auth!.user.id,
      action: 'QR_UPDATED',
      resourceType: 'qr',
      resourceId: before.id,
      metadata: { fields: Object.keys(input) },
    });
    res.json({ success: true, data: dto(updated) });
  });

  r.delete('/:qrId', requireWorkspace(ctx, 'qr:write'), async (req, res) => {
    const q = await find(req.workspace!.id, z.string().parse(req.params.qrId));
    await prisma.qRCode.delete({ where: { id: q.id } });
    await dropLogoIfUnused(q.logoPath);
    await audit(ctx, {
      workspaceId: q.workspaceId,
      userId: req.auth!.user.id,
      action: 'QR_DELETED',
      resourceType: 'qr',
      resourceId: q.id,
    });
    res.json({ success: true, data: {} });
  });

  return r;
}
