import { z } from "zod";

export const modifierGroupsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    required: z.boolean(),
    minSelections: z.number().int().nonnegative(),
    maxSelections: z.number().int().positive(),
    options: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        priceCents: z.number().int().nonnegative(),
      }),
    ),
  }),
);
export const menuItemSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1).max(160),
  description: z.string(),
  category: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  prepTimeMinutes: z.number().int().nonnegative(),
  imageUrl: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean(),
  locationIds: z.array(z.string().min(1)),
  modifierGroups: modifierGroupsSchema,
  createdAt: z.string(),
});
export const saleInputSchema = z.object({
  orgId: z.string().min(1),
  locationId: z.string().min(1),
  clientOrderId: z.string().min(1).max(160),
  orderType: z.enum(["dine_in", "takeout", "delivery"]),
  customerName: z.string(),
  customerPhone: z.string().optional(),
  customerEmail: z.string().optional(),
  deliveryAddress: z.string().optional(),
  tableNumber: z.string().optional(),
  notes: z.string().optional(),
  discountCents: z.number().int().nonnegative(),
  taxRateBasisPoints: z.number().int().min(0).max(10000),
  paymentMethod: z.enum(["cash", "card", "digital"]).optional(),
  isSimulation: z.boolean().default(false),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(1000),
        notes: z.string().optional(),
        modifiers: z.array(z.object({ groupId: z.string().min(1), optionId: z.string().min(1) })),
      }),
    )
    .min(1)
    .max(200),
});
export type SaleInput = z.input<typeof saleInputSchema>;
