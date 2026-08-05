/** Minimal inline icon set (stroke icons), so we ship no icon dependency. */
import type { SVGProps } from "react";

const paths: Record<string, string> = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  agents: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  store: "M3 9l1.5-5h15L21 9M4 9v11h16V9M9 13h6",
  spark: "M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3",
  book: "M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3V4zM7 20a3 3 0 01-3-3",
  terminal: "M4 5h16v14H4zM7 9l3 3-3 3M13 15h4",
  clock: "M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  plug: "M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0V7zM12 16v5",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 2h-5l-.4 2.9a7 7 0 00-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1l.4 2.9h5l.4-2.9a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z",
  send: "M4 12l16-7-7 16-2-7z",
  plus: "M12 5v14M5 12h14",
  stop: "M7 7h10v10H7z",
  trash: "M5 7h14M9 7V4h6v3M6 7l1 13h10l1-13",
  chevron: "M9 6l6 6-6 6",
  check: "M5 12l4 4 10-10",
  x: "M6 6l12 12M18 6L6 18",
  bolt: "M13 2L4 14h6l-1 8 9-12h-6l1-8z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  download: "M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14",
  upload: "M12 21V9m0 0l4 4m-4-4l-4 4M5 3h14",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  message: "M4 5h16v11H9l-5 4V5z",
  edit: "M4 20h4L18 10l-4-4L4 16v4zM14 6l4 4",
  brain:
    "M9 4a3 3 0 00-3 3 3 3 0 00-2 3c0 1 .4 1.9 1 2.5A3.5 3.5 0 006 19a3 3 0 003 2c1 0 2-.5 3-1.5 1 1 2 1.5 3 1.5a3 3 0 003-2 3.5 3.5 0 001-6.5c.6-.6 1-1.5 1-2.5a3 3 0 00-2-3 3 3 0 00-3-3c-1.2 0-2.3.7-3 1.5C11.3 4.7 10.2 4 9 4zM12 5.5V20",
  hammer:
    "M14 4l6 6-2 2-6-6 2-2zM12 6L3 15l3 3 9-9M9 3c2 0 5 1 6 3",
  memory:
    "M5 8h14v11H5zM8 8V5m4 3V5m4 3V5M8 19v2m4-2v2m4-2v2M9 12h6v3H9z",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8v.01",
};

export function Icon({
  name,
  size = 18,
  ...props
}: { name: keyof typeof paths | string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}
