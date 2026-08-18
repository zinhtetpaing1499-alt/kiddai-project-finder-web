type PlaceholderPanelProps = {
  label: string;
  title: string;
  text: string;
  wide?: boolean;
};

export function PlaceholderPanel({
  label,
  title,
  text,
  wide = false,
}: PlaceholderPanelProps) {
  return (
    <section className={`panel${wide ? " panel--wide" : ""}`}>
      <p className="panel__label">{label}</p>
      <h3 className="panel__title">{title}</h3>
      <p className="panel__text">{text}</p>
    </section>
  );
}
