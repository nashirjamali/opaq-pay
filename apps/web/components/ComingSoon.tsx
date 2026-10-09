import type { ComponentType } from "react";
import type { IconType } from "react-icons";
import { Icon as Glyph } from "./Icon";
import { MarkArt } from "./MarkArt";

export function ComingSoon({
  Icon,
  title,
  points,
  children,
}: {
  Icon: ComponentType<{ size?: number }>;
  title: string;
  points: { glyph: IconType; text: string }[];
  children: React.ReactNode;
}) {
  return (
    <section className="card soon" aria-labelledby="soon-title">
      <MarkArt className="soon-art" />
      <span className="tile tile-lg" aria-hidden="true"><Icon size={26} /></span>
      <div className="soon-body">
        <p className="soon-tag">Coming soon</p>
        <h2 id="soon-title">{title}</h2>
        <p className="muted">{children}</p>
        <ul className="soon-list">
          {points.map((p) => (
            <li key={p.text}>
              <Glyph as={p.glyph} size={18} />
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
