import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-3xl md:text-4xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Placeholder({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} />
      <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-card p-10 text-center text-muted-foreground">
        Questa schermata sarà progettata nella prossima fase.
      </div>
    </div>
  );
}
