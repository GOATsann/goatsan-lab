// The icon names the tutor may use, in one fixed list (the drawings come from Lucide, ISC licence).
// Kept separate from the components so the server can validate names without loading React.
export const ICON_NAMES = [
  "robot", "robot-arm", "humanoid", "person", "people", "hand", "grab", "eye", "camera", "video", "image", "mic",
  "brain", "chip", "cpu", "gpu", "server", "database", "cloud", "network", "layers", "code", "binary", "terminal",
  "monitor", "keyboard", "mouse", "gamepad", "joystick", "document", "book", "chat", "chart", "bar-chart", "target",
  "trophy", "lightbulb", "bolt", "gear", "rocket", "shield", "clock", "timer", "search", "scan", "radar", "map",
  "globe", "footprints", "car", "truck", "box", "package", "puzzle", "blocks", "pickaxe", "sword", "gem", "tree",
  "leaf", "dna", "microscope", "flask", "atom", "pill", "heart", "activity", "cat", "dog", "bug", "sparkles",
  "sigma", "check", "cross", "warning", "question", "list",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
export const isIconName = (n: unknown): n is IconName => typeof n === "string" && (ICON_NAMES as readonly string[]).includes(n);
