'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sidebar } from './Sidebar';
import { DocViewer } from './DocViewer';
import type { FolderNode } from '@/lib/kb';

type Backlink = {
  slug: string;
  title: string;
};

type DocMeta = {
  type?: string;
  status?: string;
  source?: string;
  confidence?: string;
};

type KbDocPageClientProps = {
  tree: FolderNode[];
  slugParts: string[];
  slugPath: string;
  title: string;
  tags?: string[];
  html: string;
  created?: string;
  updated?: string;
  backlinks?: Backlink[];
  meta?: DocMeta;
};

export function KbDocPageClient({
  tree,
  slugParts,
  slugPath,
  title,
  tags,
  html,
  created,
  updated,
  backlinks,
  meta,
}: KbDocPageClientProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="flex h-screen">
      <Sidebar
        tree={tree}
        currentSlug={slugPath}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
        onMobileToggle={() => setIsMobileOpen((prev) => !prev)}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-[60px] bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-center px-4 md:px-6 gap-2 md:gap-3 shrink-0">
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={() => setIsMobileOpen((prev) => !prev)}
            className="md:hidden h-11 w-11 inline-flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors shrink-0"
          >
            <span className="text-lg">☰</span>
          </button>
          <nav className="flex items-center gap-1.5 md:gap-2 text-sm text-[var(--text-dim)] flex-1 overflow-x-auto whitespace-nowrap scrollbar-none">
            <Link href="/kb" className="hover:text-[var(--accent)] active:text-[var(--accent)] transition-colors py-1 shrink-0">
              <span className="hidden sm:inline">Knowledge Base</span>
              <span className="sm:hidden">KB</span>
            </Link>
            {slugParts.slice(0, -1).map((part, i) => (
              <span key={`${part}-${i}`} className="flex items-center gap-1.5 md:gap-2 shrink-0">
                <span className="opacity-50">/</span>
                <span className="capitalize max-w-[100px] truncate">{part}</span>
              </span>
            ))}
          </nav>
        </header>

        {/* Document content */}
        <DocViewer
          title={title}
          tags={tags}
          html={html}
          created={created}
          updated={updated}
          backlinks={backlinks}
          meta={meta}
        />
      </main>
    </div>
  );
}
