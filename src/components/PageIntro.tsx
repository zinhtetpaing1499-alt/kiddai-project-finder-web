type PageIntroProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PageIntro({ eyebrow, title, description }: PageIntroProps) {
  return (
    <section className="page__hero">
      <div>
        <p className="page__eyebrow">{eyebrow}</p>
        <h2 className="page__title">{title}</h2>
      </div>
      <p className="page__description">{description}</p>
    </section>
  );
}
