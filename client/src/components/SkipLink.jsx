export function SkipLink({ href = "#main-content" }) {
  return (
    <a href={href} className="skip-link">
      Skip to main content
    </a>
  );
}

export default SkipLink;
