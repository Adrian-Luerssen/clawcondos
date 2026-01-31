'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Sidebar } from './Sidebar';
import type { DocumentSummary, FolderNode } from '@/lib/kb';

type KbPageClientProps = {
  hasKb: boolean;
  tree: FolderNode[];
  docs: DocumentSummary[];
};

export function KbPageClient({ hasKb, tree, docs }: KbPageClientProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const docsByType = useMemo(() => {
    return docs.reduce((acc, doc) => {
      const type = doc.type || 'note';
      if (!acc[type]) acc[type] = [];
      acc[type].push(doc);
      return acc;
    }, {} as Record<string, DocumentSummary[]>);
  }, [docs]);

  const recentDocs = docs.slice(0, 10);

  return (
    <div className="flex h-screen">
      <Sidebar
        tree={tree}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
        onMobileToggle={() => setIsMobileOpen((prev) => !prev)}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-[60px] bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] flex items-center px-4 md:px-6 gap-3 shrink-0">
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={() => setIsMobileOpen((prev) => !prev)}
            className="md:hidden h-11 w-11 inline-flex items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors"
          >
            <span className="text-lg">☰</span>
          </button>
          <h1 className="text-lg sm:text-xl font-semibold tracking-tight truncate">Knowledge Base</h1>
          <span className="text-sm text-[var(--text-dim)] hidden sm:inline">
            {docs.length} documents
          </span>
          <span className="text-sm text-[var(--text-dim)] sm:hidden">
            {docs.length} docs
          </span>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {!hasKb ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-8 text-center">
              <div className="text-5xl mb-4 opacity-40">📂</div>
              <h2 className="text-lg font-medium mb-2">No knowledge base found</h2>
              <p className="text-[var(--text-dim)] mb-4">
                Create a <code className="text-[var(--accent)]">kb/</code> folder
                in your project root to get started.
              </p>
            </div>
          ) : docs.length === 0 ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-8 text-center">
              <div className="text-5xl mb-4 opacity-40">📝</div>
              <h2 className="text-lg font-medium mb-2">No documents yet</h2>
              <p className="text-[var(--text-dim)]">
                Add markdown files to the{' '}
                <code className="text-[var(--accent)]">kb/</code> folder to see
                them here.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Recent documents */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">
                  Recent Documents
                </h2>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {recentDocs.map((doc) => (
                    <Link
                      key={doc.slug}
                      href={`/kb/${doc.slug}`}
                      className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 min-h-[56px] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-all group"
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-xl opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                          📄
                        </span>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-[var(--text)] line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
                            {doc.title}
                          </h3>
                          {doc.type && (
                            <span className="text-xs text-[var(--text-dim)] capitalize">
                              {doc.type}
                            </span>
                          )}
                          {doc.tags && doc.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {doc.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--accent-muted)] text-[var(--accent)]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              {/* By type */}
              {Object.entries(docsByType).map(([type, typeDocs]) => (
                <section key={type}>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 md:mb-4 capitalize">
                    {type}s ({typeDocs.length})
                  </h2>
                  <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] divide-y divide-[var(--border-subtle)]">
                    {typeDocs.map((doc) => (
                      <Link
                        key={doc.slug}
                        href={`/kb/${doc.slug}`}
                        className="flex items-center gap-3 px-3 sm:px-4 py-3 min-h-[52px] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors group"
                      >
                        <span className="opacity-60 shrink-0">📄</span>
                        <span className="flex-1 min-w-0 text-[var(--text-secondary)] group-hover:text-[var(--text)] line-clamp-2 sm:truncate">
                          {doc.title}
                        </span>
                        {doc.tags && doc.tags.length > 0 && (
                          <div className="hidden sm:flex gap-1 shrink-0">
                            {doc.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--accent-muted)] text-[var(--accent)]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">→</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
