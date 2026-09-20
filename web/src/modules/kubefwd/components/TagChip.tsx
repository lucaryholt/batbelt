import { tagColor } from "../tagColor";

export function TagChip({
  tag,
  selected,
  onClick,
  removable,
}: {
  tag: string;
  selected?: boolean;
  onClick?: () => void;
  removable?: boolean;
}) {
  const colors = tagColor(tag);
  const interactive = !!onClick;
  return (
    <button
      type="button"
      className={`tag-chip${selected ? " selected" : ""}${interactive ? "" : " static"}`}
      style={{
        background: colors.background,
        borderColor: selected ? colors.color : colors.borderColor,
        color: colors.color,
      }}
      onClick={onClick}
      disabled={!interactive}
      title={removable ? `Remove ${tag}` : tag}
    >
      {tag}
      {removable ? <span className="tag-chip-x">×</span> : null}
    </button>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="tag-list">
      {tags.map((t) => (
        <TagChip key={t} tag={t} />
      ))}
    </span>
  );
}
