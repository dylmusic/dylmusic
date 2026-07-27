export default function Win95Window({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="win95-window">
      <div className="win95-titlebar">
        <span className="win95-titlebar-label">{title}</span>
        <div className="win95-controls">
          <span className="win95-dot" />
          <span className="win95-dot" />
          {onClose ? (
            <button className="win95-dot win95-close" onClick={onClose} aria-label="Close">
              <svg width="7" height="7" viewBox="0 0 8 8">
                <path
                  d="M1 1l6 6M7 1l-6 6"
                  stroke="#04140a"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : (
            <span className="win95-dot" />
          )}
        </div>
      </div>
      <div className="win95-body">{children}</div>
    </div>
  );
}
