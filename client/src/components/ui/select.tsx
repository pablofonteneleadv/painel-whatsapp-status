import * as React from "react";
import { cn } from "@/lib/utils";

/** Native select, styled to match Input. Keeps keyboard + mobile behaviour free. */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-input bg-background/60 bg-[length:1rem] bg-[right_0.6rem_center] bg-no-repeat px-3 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2388a0a8' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
