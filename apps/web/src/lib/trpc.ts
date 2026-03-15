import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@tehfrontier/api/src/trpc/router";

export const trpc = createTRPCReact<AppRouter>();
