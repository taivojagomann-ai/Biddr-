// shadcn/ui Button (new-york), tuned to the asphalt palette.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Touch screens get 44px targets; mouse users keep the compact sizes (all are at least 24px, WCAG 2.5.8).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [@media(pointer:coarse)]:min-h-11",
  {
    variants: {
      variant: {
        default: "bg-signal text-asphalt hover:bg-[#ff6a1f] active:bg-signal-dim",
        outline: "border border-field bg-transparent text-chalk hover:border-chalk",
        ghost: "text-mute hover:bg-panel hover:text-chalk",
        secondary: "bg-line text-chalk hover:bg-[#3f3f46]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10 [@media(pointer:coarse)]:min-w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";
export { buttonVariants };
