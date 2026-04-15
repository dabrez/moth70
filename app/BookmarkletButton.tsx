'use client';

export function BookmarkletButton({ bookmarklet }: { bookmarklet: string }) {
  return (
    <a
      href={bookmarklet}
      title="Drag this to your bookmarks bar"
      className="inline-flex items-center justify-center gap-2 bg-slate-800 text-white px-6 py-3 rounded-xl text-base font-semibold hover:bg-slate-700 transition-colors shadow-sm cursor-grab active:cursor-grabbing"
      draggable="true"
      onClick={(e) => e.preventDefault()}
    >
      🔖 Drag to Bookmarks Bar
    </a>
  );
}
