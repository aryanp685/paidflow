"use client"; import * as React from "react"; import * as Primitive from "@radix-ui/react-tooltip"; import { cn } from "@/lib/utils";
export const TooltipProvider = Primitive.Provider; export const Tooltip = Primitive.Root; export const TooltipTrigger = Primitive.Trigger;
export function TooltipContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof Primitive.Content>) { return <Primitive.Portal><Primitive.Content sideOffset={sideOffset} className={cn("z-50 rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white shadow-md", className)} {...props}/></Primitive.Portal>; }
