import { useUi } from "../../app/store";
import { Button, EmptyState } from "../../components/ui";

export function NoCard() {
  const setSection = useUi((s) => s.setSection);
  return (
    <EmptyState title="No card open">
      <p className="text-ink-muted">Open or create a card from a project in the Library.</p>
      <Button variant="primary" onClick={() => setSection("library")}>
        Go to Library
      </Button>
    </EmptyState>
  );
}
