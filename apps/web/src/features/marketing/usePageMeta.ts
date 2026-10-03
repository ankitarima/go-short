import { useEffect } from 'react';

/** Sets the tab title and meta description for a public page, and restores them on leave. */
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content;
    document.title = `${title} | goShort`;
    if (meta && description) meta.content = description;
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
    };
  }, [title, description]);
}
