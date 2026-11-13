import { cn } from "@/lib/utils";

export function Section({
  id,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 rounded-lg border border-line bg-panel p-4 sm:p-5", className)}>
      <h2 id={`${id}-title`} className="font-wide text-lg font-bold">
        {title}
      </h2>
      {intro ? <div className="mt-1 text-sm text-mute">{intro}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Label({ htmlFor, children, optional }: { htmlFor: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">
      {children}
      {optional ? <span className="ml-1.5 font-normal text-mute">(optional)</span> : null}
    </label>
  );
}
