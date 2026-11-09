import { z } from "zod";
// TanStack parses numeric query literals before validation; preserve safe direct create links.
export const onboardingSearch = z.object({ create: z.coerce.string().optional() });
