// arXiv ids from whatever people paste: "1706.03762", "1706.03762v7", "arXiv:1706.03762",
// "https://arxiv.org/abs/1706.03762", ".../pdf/1706.03762v7.pdf", old style "hep-th/9901001".
// Returns the id without its version (we always read the latest), or null.
const NEW_ID = /(\d{4}\.\d{4,5})(v\d+)?/;
const OLD_ID = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/;

export function parseArxivId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const looksLikeLink = /arxiv\.org|^arxiv:/i.test(s);
  const bare = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/.test(s);
  if (!looksLikeLink && !bare) return null;
  const m = s.match(NEW_ID) ?? s.match(OLD_ID);
  return m ? m[1] : null;
}

// Old-style ids contain a slash; in URLs and store keys we write it as "~".
export const idToSlug = (id: string) => id.replace("/", "~");
export const slugToId = (slug: string) => decodeURIComponent(slug).replace("~", "/");
export const isUploadId = (id: string) => id.startsWith("up_");
