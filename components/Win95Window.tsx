export default function Win95Window({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="win95-window">
      <div className="win95-titlebar">
        <span className="win95-titlebar-label">{title}</span>
        <div className="win95-controls">
          <span className="win95-dot" />
          <span className="win95-dot" />
          <span className="win95-dot" />
        </div>
      </div>
      <div className="win95-body">{children}</div>
    </div>
  );
}
