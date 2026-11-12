function embedUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (u.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed${u.pathname}`;
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function VideoPlayer({ url, title }: { url: string; title: string }) {
  const embed = embedUrl(url);
  return (
    <section aria-labelledby="video-heading">
      <h2 id="video-heading" className="mb-3 text-lg font-bold">Cold start and walkaround</h2>
      <div className="aspect-video overflow-hidden rounded-lg border border-line bg-panel">
        {embed ? (
          <iframe src={embed} title={`${title}: cold start and walkaround`} className="h-full w-full"
            allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" loading="lazy" />
        ) : (
          <video src={url} controls preload="metadata" playsInline className="h-full w-full">
            Your browser can&apos;t play this video. <a href={url}>Download it</a> instead.
          </video>
        )}
      </div>
    </section>
  );
}
