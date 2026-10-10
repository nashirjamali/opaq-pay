import { CbCircle, CbIcon, type CbCircleName, type CbIconName } from "./CbIcon";

export function ComingSoon({
  badge,
  title,
  points,
  children,
}: {
  badge: CbCircleName;
  title: string;
  points: { icon: CbIconName; text: string }[];
  children: React.ReactNode;
}) {
  return (
    <section className="card soon" aria-labelledby="soon-title">
      <CbCircle name={badge} size={56} />
      <div className="soon-body">
        <p className="soon-tag">Coming soon</p>
        <h2 id="soon-title">{title}</h2>
        <p className="muted">{children}</p>
        <ul className="soon-list">
          {points.map((p) => (
            <li key={p.text}>
              <CbIcon name={p.icon} size={18} />
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
