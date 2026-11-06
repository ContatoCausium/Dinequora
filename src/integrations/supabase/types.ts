export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          org_id: string | null;
          target: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          org_id?: string | null;
          target?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          org_id?: string | null;
          target?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_events: {
        Row: {
          amount_cents: number | null;
          currency: string;
          description: string | null;
          id: string;
          kind: string;
          occurred_at: string;
          org_id: string;
          status: string | null;
          stripe_ref: string | null;
        };
        Insert: {
          amount_cents?: number | null;
          currency?: string;
          description?: string | null;
          id?: string;
          kind: string;
          occurred_at?: string;
          org_id: string;
          status?: string | null;
          stripe_ref?: string | null;
        };
        Update: {
          amount_cents?: number | null;
          currency?: string;
          description?: string | null;
          id?: string;
          kind?: string;
          occurred_at?: string;
          org_id?: string;
          status?: string | null;
          stripe_ref?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "billing_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_plans: {
        Row: {
          active: boolean;
          currency: string;
          default_store_limit: number;
          entitlements: Json;
          id: string;
          is_placeholder_pricing: boolean;
          name: string;
          price_per_location_cents: number;
          stripe_price_id: string | null;
          trial_days: number;
          trial_store_limit: number;
        };
        Insert: {
          active?: boolean;
          currency?: string;
          default_store_limit?: number;
          entitlements?: Json;
          id: string;
          is_placeholder_pricing?: boolean;
          name: string;
          price_per_location_cents?: number;
          stripe_price_id?: string | null;
          trial_days?: number;
          trial_store_limit?: number;
        };
        Update: {
          active?: boolean;
          currency?: string;
          default_store_limit?: number;
          entitlements?: Json;
          id?: string;
          is_placeholder_pricing?: boolean;
          name?: string;
          price_per_location_cents?: number;
          stripe_price_id?: string | null;
          trial_days?: number;
          trial_store_limit?: number;
        };
        Relationships: [];
      };
      finance_entries: {
        Row: {
          actor_id: string;
          amount_cents: number;
          client_event_id: string;
          created_at: string;
          description: string;
          id: string;
          kind: string;
          location_id: string;
          order_id: string | null;
          org_id: string;
          reverses_id: string | null;
        };
        Insert: {
          actor_id: string;
          amount_cents: number;
          client_event_id: string;
          created_at?: string;
          description: string;
          id?: string;
          kind: string;
          location_id: string;
          order_id?: string | null;
          org_id: string;
          reverses_id?: string | null;
        };
        Update: {
          actor_id?: string;
          amount_cents?: number;
          client_event_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          kind?: string;
          location_id?: string;
          order_id?: string | null;
          org_id?: string;
          reverses_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "finance_entries_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_entries_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_entries_org_id_location_id_order_id_fkey";
            columns: ["org_id", "location_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["org_id", "location_id", "id"];
          },
          {
            foreignKeyName: "finance_entries_reverses_id_fkey";
            columns: ["reverses_id"];
            isOneToOne: true;
            referencedRelation: "finance_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      finance_expenses: {
        Row: {
          active: boolean;
          id: string;
          location_id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          id?: string;
          location_id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          id?: string;
          location_id?: string;
          org_id?: string;
          payload?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finance_expenses_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finance_expenses_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_items: {
        Row: {
          active: boolean;
          category: string;
          client_id: string;
          cost_cents: number;
          expiration_date: string | null;
          id: string;
          location_id: string;
          min_quantity: number;
          name: string;
          org_id: string;
          quantity: number;
          sku: string;
          supplier: string;
          unit: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          category?: string;
          client_id: string;
          cost_cents?: number;
          expiration_date?: string | null;
          id?: string;
          location_id: string;
          min_quantity?: number;
          name: string;
          org_id: string;
          quantity?: number;
          sku?: string;
          supplier?: string;
          unit: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          category?: string;
          client_id?: string;
          cost_cents?: number;
          expiration_date?: string | null;
          id?: string;
          location_id?: string;
          min_quantity?: number;
          name?: string;
          org_id?: string;
          quantity?: number;
          sku?: string;
          supplier?: string;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          actor_id: string;
          client_event_id: string;
          created_at: string;
          delta: number;
          id: string;
          inventory_item_id: string;
          kind: string;
          location_id: string;
          order_id: string | null;
          org_id: string;
          reason: string;
          request_hash: string | null;
          reverses_id: string | null;
          unit_cost_cents: number;
        };
        Insert: {
          actor_id: string;
          client_event_id: string;
          created_at?: string;
          delta: number;
          id?: string;
          inventory_item_id: string;
          kind: string;
          location_id: string;
          order_id?: string | null;
          org_id: string;
          reason: string;
          request_hash?: string | null;
          reverses_id?: string | null;
          unit_cost_cents: number;
        };
        Update: {
          actor_id?: string;
          client_event_id?: string;
          created_at?: string;
          delta?: number;
          id?: string;
          inventory_item_id?: string;
          kind?: string;
          location_id?: string;
          order_id?: string | null;
          org_id?: string;
          reason?: string;
          request_hash?: string | null;
          reverses_id?: string | null;
          unit_cost_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_org_id_location_id_inventory_item_id_fkey";
            columns: ["org_id", "location_id", "inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["org_id", "location_id", "id"];
          },
          {
            foreignKeyName: "inventory_movements_org_id_location_id_order_id_fkey";
            columns: ["org_id", "location_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["org_id", "location_id", "id"];
          },
          {
            foreignKeyName: "inventory_movements_reverses_id_fkey";
            columns: ["reverses_id"];
            isOneToOne: true;
            referencedRelation: "inventory_movements";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          location_ids: string[];
          org_id: string;
          revoked_at: string | null;
          role: Database["public"]["Enums"]["org_role"];
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          location_ids?: string[];
          org_id: string;
          revoked_at?: string | null;
          role?: Database["public"]["Enums"]["org_role"];
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          location_ids?: string[];
          org_id?: string;
          revoked_at?: string | null;
          role?: Database["public"]["Enums"]["org_role"];
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      locations: {
        Row: {
          address: string | null;
          created_at: string;
          hours: Json;
          id: string;
          is_verified: boolean;
          name: string;
          org_id: string;
          phone: string | null;
          slug: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          hours?: Json;
          id?: string;
          is_verified?: boolean;
          name: string;
          org_id: string;
          phone?: string | null;
          slug: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          hours?: Json;
          id?: string;
          is_verified?: boolean;
          name?: string;
          org_id?: string;
          phone?: string | null;
          slug?: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "locations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      member_location_access: {
        Row: {
          location_id: string;
          member_id: string;
        };
        Insert: {
          location_id: string;
          member_id: string;
        };
        Update: {
          location_id?: string;
          member_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_location_access_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_location_access_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "organization_members";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_categories: {
        Row: {
          active: boolean;
          client_id: string;
          description: string;
          id: string;
          name: string;
          org_id: string;
        };
        Insert: {
          active?: boolean;
          client_id: string;
          description?: string;
          id?: string;
          name: string;
          org_id: string;
        };
        Update: {
          active?: boolean;
          client_id?: string;
          description?: string;
          id?: string;
          name?: string;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_categories_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_products: {
        Row: {
          active: boolean;
          category_id: string | null;
          client_id: string;
          created_at: string;
          description: string;
          id: string;
          image_url: string | null;
          location_ids: string[];
          modifier_groups: Json;
          name: string;
          notes: string | null;
          org_id: string;
          prep_time_minutes: number;
          price_cents: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          category_id?: string | null;
          client_id: string;
          created_at?: string;
          description?: string;
          id?: string;
          image_url?: string | null;
          location_ids?: string[];
          modifier_groups?: Json;
          name: string;
          notes?: string | null;
          org_id: string;
          prep_time_minutes?: number;
          price_cents: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          category_id?: string | null;
          client_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          image_url?: string | null;
          location_ids?: string[];
          modifier_groups?: Json;
          name?: string;
          notes?: string | null;
          org_id?: string;
          prep_time_minutes?: number;
          price_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_products_org_id_category_id_fkey";
            columns: ["org_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "menu_categories";
            referencedColumns: ["org_id", "id"];
          },
          {
            foreignKeyName: "menu_products_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      order_item_modifiers: {
        Row: {
          group_id: string;
          group_name: string;
          id: string;
          option_id: string;
          option_name: string;
          order_item_id: string;
          price_cents: number;
        };
        Insert: {
          group_id: string;
          group_name: string;
          id?: string;
          option_id: string;
          option_name: string;
          order_item_id: string;
          price_cents: number;
        };
        Update: {
          group_id?: string;
          group_name?: string;
          id?: string;
          option_id?: string;
          option_name?: string;
          order_item_id?: string;
          price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          is_item_ready: boolean;
          location_id: string;
          notes: string | null;
          order_id: string;
          org_id: string;
          product_id: string;
          product_name: string;
          quantity: number;
          subtotal_cents: number;
          unit_price_cents: number;
        };
        Insert: {
          id?: string;
          is_item_ready?: boolean;
          location_id: string;
          notes?: string | null;
          order_id: string;
          org_id: string;
          product_id: string;
          product_name: string;
          quantity: number;
          subtotal_cents: number;
          unit_price_cents: number;
        };
        Update: {
          id?: string;
          is_item_ready?: boolean;
          location_id?: string;
          notes?: string | null;
          order_id?: string;
          org_id?: string;
          product_id?: string;
          product_name?: string;
          quantity?: number;
          subtotal_cents?: number;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_org_id_location_id_order_id_fkey";
            columns: ["org_id", "location_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["org_id", "location_id", "id"];
          },
          {
            foreignKeyName: "order_items_org_id_product_id_fkey";
            columns: ["org_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "menu_products";
            referencedColumns: ["org_id", "id"];
          },
        ];
      };
      order_status_history: {
        Row: {
          actor_id: string;
          created_at: string;
          from_status: Database["public"]["Enums"]["order_status"] | null;
          id: string;
          location_id: string;
          order_id: string;
          org_id: string;
          reason: string | null;
          to_status: Database["public"]["Enums"]["order_status"];
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          from_status?: Database["public"]["Enums"]["order_status"] | null;
          id?: string;
          location_id: string;
          order_id: string;
          org_id: string;
          reason?: string | null;
          to_status: Database["public"]["Enums"]["order_status"];
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          from_status?: Database["public"]["Enums"]["order_status"] | null;
          id?: string;
          location_id?: string;
          order_id?: string;
          org_id?: string;
          reason?: string | null;
          to_status?: Database["public"]["Enums"]["order_status"];
        };
        Relationships: [
          {
            foreignKeyName: "order_status_history_org_id_location_id_order_id_fkey";
            columns: ["org_id", "location_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["org_id", "location_id", "id"];
          },
        ];
      };
      orders: {
        Row: {
          client_order_id: string;
          created_at: string;
          created_by: string;
          customer_email: string | null;
          customer_name: string;
          customer_phone: string | null;
          delivery_address: string | null;
          discount_cents: number;
          id: string;
          is_simulation: boolean;
          location_id: string;
          notes: string | null;
          order_number: string;
          org_id: string;
          request_hash: string;
          status: Database["public"]["Enums"]["order_status"];
          subtotal_cents: number;
          table_number: string | null;
          tax_cents: number;
          tax_rate_basis_points: number;
          total_cents: number;
          type: Database["public"]["Enums"]["order_type"];
          updated_at: string;
        };
        Insert: {
          client_order_id: string;
          created_at?: string;
          created_by: string;
          customer_email?: string | null;
          customer_name?: string;
          customer_phone?: string | null;
          delivery_address?: string | null;
          discount_cents?: number;
          id?: string;
          is_simulation?: boolean;
          location_id: string;
          notes?: string | null;
          order_number: string;
          org_id: string;
          request_hash: string;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal_cents?: number;
          table_number?: string | null;
          tax_cents?: number;
          tax_rate_basis_points?: number;
          total_cents?: number;
          type: Database["public"]["Enums"]["order_type"];
          updated_at?: string;
        };
        Update: {
          client_order_id?: string;
          created_at?: string;
          created_by?: string;
          customer_email?: string | null;
          customer_name?: string;
          customer_phone?: string | null;
          delivery_address?: string | null;
          discount_cents?: number;
          id?: string;
          is_simulation?: boolean;
          location_id?: string;
          notes?: string | null;
          order_number?: string;
          org_id?: string;
          request_hash?: string;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal_cents?: number;
          table_number?: string | null;
          tax_cents?: number;
          tax_rate_basis_points?: number;
          total_cents?: number;
          type?: Database["public"]["Enums"]["order_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          role?: Database["public"]["Enums"]["org_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          brand_accent: string;
          brand_primary: string;
          company_address: string;
          company_name: string;
          created_at: string;
          created_by: string | null;
          id: string;
          is_demo: boolean;
          logo_url: string | null;
          name: string;
          onboarding_step: number;
          plan: string;
          previous_brand: Json | null;
          slug: string;
          status: string;
          store_limit: number;
          store_limit_override: number | null;
          suspended_reason: string | null;
        };
        Insert: {
          brand_accent?: string;
          brand_primary?: string;
          company_address?: string;
          company_name?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          logo_url?: string | null;
          name: string;
          onboarding_step?: number;
          plan?: string;
          previous_brand?: Json | null;
          slug: string;
          status?: string;
          store_limit?: number;
          store_limit_override?: number | null;
          suspended_reason?: string | null;
        };
        Update: {
          brand_accent?: string;
          brand_primary?: string;
          company_address?: string;
          company_name?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_demo?: boolean;
          logo_url?: string | null;
          name?: string;
          onboarding_step?: number;
          plan?: string;
          previous_brand?: Json | null;
          slug?: string;
          status?: string;
          store_limit?: number;
          store_limit_override?: number | null;
          suspended_reason?: string | null;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount_cents: number;
          created_at: string;
          id: string;
          location_id: string;
          method: string;
          order_id: string;
          org_id: string;
          reversed_at: string | null;
          status: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          id?: string;
          location_id: string;
          method: string;
          order_id: string;
          org_id: string;
          reversed_at?: string | null;
          status?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          id?: string;
          location_id?: string;
          method?: string;
          order_id?: string;
          org_id?: string;
          reversed_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_org_id_location_id_order_id_fkey";
            columns: ["org_id", "location_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["org_id", "location_id", "id"];
          },
        ];
      };
      platform_bootstrap: {
        Row: {
          authorization_note: string;
          completed_at: string;
          id: boolean;
          user_id: string;
        };
        Insert: {
          authorization_note: string;
          completed_at?: string;
          id?: boolean;
          user_id: string;
        };
        Update: {
          authorization_note?: string;
          completed_at?: string;
          id?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      product_recipes: {
        Row: {
          id: string;
          instructions: string;
          location_id: string;
          metadata: Json;
          org_id: string;
          product_id: string;
          servings: number;
          updated_at: string;
          yield_quantity: number;
          yield_unit: string;
        };
        Insert: {
          id?: string;
          instructions?: string;
          location_id: string;
          metadata?: Json;
          org_id: string;
          product_id: string;
          servings: number;
          updated_at?: string;
          yield_quantity?: number;
          yield_unit?: string;
        };
        Update: {
          id?: string;
          instructions?: string;
          location_id?: string;
          metadata?: Json;
          org_id?: string;
          product_id?: string;
          servings?: number;
          updated_at?: string;
          yield_quantity?: number;
          yield_unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_recipes_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_recipes_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_recipes_org_id_product_id_fkey";
            columns: ["org_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "menu_products";
            referencedColumns: ["org_id", "id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          preferred_language: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          preferred_language?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          preferred_language?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      purchase_order_items: {
        Row: {
          id: string;
          inventory_item_id: string;
          location_id: string;
          org_id: string;
          purchase_order_id: string;
          quantity_ordered: number;
          quantity_received: number;
          unit_price_cents: number;
        };
        Insert: {
          id?: string;
          inventory_item_id: string;
          location_id: string;
          org_id: string;
          purchase_order_id: string;
          quantity_ordered: number;
          quantity_received?: number;
          unit_price_cents: number;
        };
        Update: {
          id?: string;
          inventory_item_id?: string;
          location_id?: string;
          org_id?: string;
          purchase_order_id?: string;
          quantity_ordered?: number;
          quantity_received?: number;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_org_id_location_id_inventory_item_id_fkey";
            columns: ["org_id", "location_id", "inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["org_id", "location_id", "id"];
          },
          {
            foreignKeyName: "purchase_order_items_org_id_location_id_purchase_order_id_fkey";
            columns: ["org_id", "location_id", "purchase_order_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["org_id", "location_id", "id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          created_at: string;
          discount_cents: number;
          id: string;
          location_id: string;
          metadata: Json;
          notes: string;
          org_id: string;
          shipping_cents: number;
          status: string;
          supplier_id: string;
          tax_cents: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          discount_cents?: number;
          id?: string;
          location_id: string;
          metadata?: Json;
          notes?: string;
          org_id: string;
          shipping_cents?: number;
          status?: string;
          supplier_id: string;
          tax_cents?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          discount_cents?: number;
          id?: string;
          location_id?: string;
          metadata?: Json;
          notes?: string;
          org_id?: string;
          shipping_cents?: number;
          status?: string;
          supplier_id?: string;
          tax_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_org_id_supplier_id_fkey";
            columns: ["org_id", "supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["org_id", "id"];
          },
        ];
      };
      purchase_receipts: {
        Row: {
          actor_id: string;
          client_event_id: string;
          created_at: string;
          id: string;
          items: Json;
          location_id: string;
          org_id: string;
          payload_hash: string;
          purchase_order_id: string;
        };
        Insert: {
          actor_id: string;
          client_event_id: string;
          created_at?: string;
          id?: string;
          items: Json;
          location_id: string;
          org_id: string;
          payload_hash: string;
          purchase_order_id: string;
        };
        Update: {
          actor_id?: string;
          client_event_id?: string;
          created_at?: string;
          id?: string;
          items?: Json;
          location_id?: string;
          org_id?: string;
          payload_hash?: string;
          purchase_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_org_id_location_id_purchase_order_id_fkey";
            columns: ["org_id", "location_id", "purchase_order_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["org_id", "location_id", "id"];
          },
        ];
      };
      recipe_ingredients: {
        Row: {
          id: string;
          inventory_item_id: string;
          location_id: string;
          org_id: string;
          quantity: number;
          recipe_id: string;
          unit: string;
          waste_percentage: number;
        };
        Insert: {
          id?: string;
          inventory_item_id: string;
          location_id: string;
          org_id: string;
          quantity: number;
          recipe_id: string;
          unit: string;
          waste_percentage?: number;
        };
        Update: {
          id?: string;
          inventory_item_id?: string;
          location_id?: string;
          org_id?: string;
          quantity?: number;
          recipe_id?: string;
          unit?: string;
          waste_percentage?: number;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_org_id_location_id_inventory_item_id_fkey";
            columns: ["org_id", "location_id", "inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["org_id", "location_id", "id"];
          },
          {
            foreignKeyName: "recipe_ingredients_org_id_location_id_recipe_id_fkey";
            columns: ["org_id", "location_id", "recipe_id"];
            isOneToOne: false;
            referencedRelation: "product_recipes";
            referencedColumns: ["org_id", "location_id", "id"];
          },
        ];
      };
      stripe_webhook_events: {
        Row: {
          error: string | null;
          id: string;
          org_id: string | null;
          processed_at: string | null;
          received_at: string;
          type: string;
        };
        Insert: {
          error?: string | null;
          id: string;
          org_id?: string | null;
          processed_at?: string | null;
          received_at?: string;
          type: string;
        };
        Update: {
          error?: string | null;
          id?: string;
          org_id?: string | null;
          processed_at?: string | null;
          received_at?: string;
          type?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          billed_locations: number;
          cancel_at_period_end: boolean;
          canceled_at: string | null;
          current_period_end: string | null;
          current_period_start: string | null;
          grace_ends_at: string | null;
          org_id: string;
          plan_id: string;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          trial_ends_at: string | null;
          updated_at: string;
        };
        Insert: {
          billed_locations?: number;
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
          current_period_end?: string | null;
          current_period_start?: string | null;
          grace_ends_at?: string | null;
          org_id: string;
          plan_id?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          billed_locations?: number;
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
          current_period_end?: string | null;
          current_period_start?: string | null;
          grace_ends_at?: string | null;
          org_id?: string;
          plan_id?: string;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "billing_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          active: boolean;
          details: Json;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          details?: Json;
          id?: string;
          name: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          details?: Json;
          id?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["platform_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["platform_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["platform_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      whatsapp_records: {
        Row: {
          created_at: string;
          id: string;
          is_simulation: boolean;
          kind: string;
          org_id: string;
          payload: Json;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_simulation?: boolean;
          kind: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_simulation?: boolean;
          kind?: string;
          org_id?: string;
          payload?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_records_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string };
      active_store_count: { Args: { _org_id: string }; Returns: number };
      admin_assign_owner: {
        Args: { _email: string; _org_id: string; _verification_note: string };
        Returns: undefined;
      };
      admin_list_audit: {
        Args: { _limit?: number };
        Returns: {
          action: string;
          actor_id: string;
          created_at: string;
          id: string;
          metadata: Json;
          org_id: string;
          org_name: string;
          target: string;
        }[];
      };
      admin_list_organizations: {
        Args: never;
        Returns: {
          created_at: string;
          id: string;
          is_demo: boolean;
          member_count: number;
          name: string;
          owner_count: number;
          plan: string;
          slug: string;
          status: string;
          store_count: number;
          store_limit: number;
        }[];
      };
      admin_list_platform_admins: {
        Args: never;
        Returns: {
          email: string;
          role: Database["public"]["Enums"]["platform_role"];
          user_id: string;
        }[];
      };
      admin_org_insights: {
        Args: never;
        Returns: {
          active_store_count: number;
          billed_locations: number;
          billing_connected: boolean;
          brand_customized: boolean;
          created_at: string;
          has_override: boolean;
          id: string;
          is_demo: boolean;
          last_activity: string;
          member_count: number;
          name: string;
          owner_count: number;
          owner_email: string;
          pending_invites: number;
          plan: string;
          status: string;
          store_count: number;
          store_limit: number;
          sub_status: string;
          trial_ends_at: string;
        }[];
      };
      admin_set_platform_role: {
        Args: {
          _email: string;
          _grant: boolean;
          _reason: string;
          _role: Database["public"]["Enums"]["platform_role"];
        };
        Returns: undefined;
      };
      admin_set_subscription: {
        Args: {
          _org_id: string;
          _plan: string;
          _reason: string;
          _status: string;
        };
        Returns: undefined;
      };
      admin_update_organization: {
        Args: {
          _org_id: string;
          _plan: string;
          _reason: string;
          _status: string;
          _store_limit: number;
        };
        Returns: undefined;
      };
      archive_operational_menu: {
        Args: { _client_id: string; _kind: string; _org_id: string };
        Returns: undefined;
      };
      assert_operational_scope: {
        Args: { _location_id: string; _manage?: boolean; _org_id: string };
        Returns: undefined;
      };
      assert_org_operational: { Args: { _org_id: string }; Returns: undefined };
      billing_apply_stripe_event: {
        Args: {
          _amount_cents: number;
          _cancel_at_period_end: boolean;
          _currency: string;
          _customer: string;
          _event_id: string;
          _org_id: string;
          _period_end: string;
          _period_start: string;
          _plan: string;
          _status: string;
          _subscription: string;
          _type: string;
        };
        Returns: boolean;
      };
      bootstrap_first_platform_admin: {
        Args: { _authorization_note: string; _user_id: string };
        Returns: undefined;
      };
      can_access_location: { Args: { _location_id: string }; Returns: boolean };
      can_manage_member: { Args: { _member_id: string }; Returns: boolean };
      can_manage_org: { Args: { _org_id: string }; Returns: boolean };
      can_operate_location: { Args: { _location_id: string }; Returns: boolean };
      cancel_operational_purchase: {
        Args: { _id: string; _reason: string };
        Returns: undefined;
      };
      cancel_order_with_reversal: {
        Args: { _order_id: string; _reason?: string };
        Returns: undefined;
      };
      create_invitation: {
        Args: {
          _email: string;
          _location_ids?: string[];
          _org_id: string;
          _role: Database["public"]["Enums"]["org_role"];
        };
        Returns: string;
      };
      create_location: {
        Args: {
          _address: string;
          _name: string;
          _org_id: string;
          _phone: string;
          _timezone: string;
        };
        Returns: string;
      };
      create_organization: {
        Args: {
          _brand_primary?: string;
          _location_name?: string;
          _name: string;
        };
        Returns: string;
      };
      create_pos_sale: {
        Args: {
          _client_order_id?: string;
          _customer_email?: string;
          _customer_name: string;
          _customer_phone?: string;
          _delivery_address?: string;
          _discount_cents?: number;
          _is_simulation?: boolean;
          _items?: Json;
          _location_id: string;
          _notes?: string;
          _org_id: string;
          _table_number?: string;
          _tax_rate_basis_points?: number;
          _type: Database["public"]["Enums"]["order_type"];
        };
        Returns: string;
      };
      create_test_restaurant: {
        Args: {
          _company_address: string;
          _company_name: string;
          _location_name: string;
          _name: string;
        };
        Returns: string;
      };
      effective_store_limit: { Args: { _org_id: string }; Returns: number };
      finalize_pos_sale_atomic: {
        Args: {
          _client_order_id?: string;
          _customer_email?: string;
          _customer_name: string;
          _customer_phone?: string;
          _delivery_address?: string;
          _discount_cents?: number;
          _is_simulation?: boolean;
          _items?: Json;
          _location_id: string;
          _notes?: string;
          _org_id: string;
          _payment_method?: string;
          _table_number?: string;
          _tax_rate_basis_points?: number;
          _type: Database["public"]["Enums"]["order_type"];
        };
        Returns: string;
      };
      get_invitation: {
        Args: { _token: string };
        Returns: {
          brand_primary: string;
          email: string;
          org_name: string;
          org_slug: string;
          role: Database["public"]["Enums"]["org_role"];
          status: string;
        }[];
      };
      has_platform_role: {
        Args: {
          _role: Database["public"]["Enums"]["platform_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_org_member: { Args: { _org_id: string }; Returns: boolean };
      is_org_owner: { Args: { _org_id: string }; Returns: boolean };
      is_platform_admin: { Args: never; Returns: boolean };
      member_scope: { Args: { _member_id: string }; Returns: string[] };
      my_member: {
        Args: { _org_id: string };
        Returns: {
          created_at: string;
          id: string;
          org_id: string;
          role: Database["public"]["Enums"]["org_role"];
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "organization_members";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      my_org_status: {
        Args: { _org_id: string };
        Returns: {
          plan: string;
          status: string;
          store_limit: number;
          suspended_reason: string;
        }[];
      };
      operational_unit_quantity: {
        Args: { _from: string; _quantity: number; _to: string };
        Returns: number;
      };
      org_is_operational: { Args: { _org_id: string }; Returns: boolean };
      persist_finalized_pos_sale_atomic: {
        Args: {
          _client_order_id?: string;
          _customer_email?: string;
          _customer_name: string;
          _customer_phone?: string;
          _delivery_address?: string;
          _discount_cents?: number;
          _is_simulation?: boolean;
          _items?: Json;
          _location_id: string;
          _notes?: string;
          _org_id: string;
          _payment_method?: string;
          _table_number?: string;
          _tax_rate_basis_points?: number;
          _type: Database["public"]["Enums"]["order_type"];
        };
        Returns: string;
      };
      receive_operational_purchase: {
        Args: {
          _client_event_id: string;
          _items: Json;
          _notes?: string;
          _purchase_id: string;
        };
        Returns: string;
      };
      record_operational_movement: {
        Args: {
          _client_event_id: string;
          _item_id: string;
          _location_id: string;
          _org_id: string;
          _quantity: number;
          _reason: string;
          _target_location_id?: string;
          _type: string;
        };
        Returns: string;
      };
      remove_member: { Args: { _member_id: string }; Returns: undefined };
      revoke_invitation: { Args: { _id: string }; Returns: undefined };
      save_location_with_managers: {
        Args: {
          _address: string;
          _hours: Json;
          _id: string;
          _member_ids: string[];
          _name: string;
          _phone: string;
          _timezone: string;
        };
        Returns: undefined;
      };
      save_operational_menu: {
        Args: { _kind: string; _org_id: string; _payload: Json };
        Returns: string;
      };
      save_operational_record: {
        Args: {
          _kind: string;
          _location_id: string;
          _org_id: string;
          _payload: Json;
        };
        Returns: string;
      };
      save_org_brand: {
        Args: {
          _accent: string;
          _logo?: string;
          _org_id: string;
          _primary: string;
        };
        Returns: undefined;
      };
      set_location_managers: {
        Args: { _location_id: string; _member_ids: string[] };
        Returns: undefined;
      };
      set_location_status: {
        Args: { _id: string; _status: string };
        Returns: undefined;
      };
      set_member_locations: {
        Args: { _location_ids: string[]; _member_id: string };
        Returns: undefined;
      };
      set_member_role: {
        Args: {
          _member_id: string;
          _role: Database["public"]["Enums"]["org_role"];
        };
        Returns: undefined;
      };
      set_onboarding_step: {
        Args: { _org_id: string; _step: number };
        Returns: undefined;
      };
      set_order_item_ready: {
        Args: { _item_id: string; _ready: boolean };
        Returns: undefined;
      };
      shares_org_with: { Args: { _user_id: string }; Returns: boolean };
      sync_org_entitlements: { Args: { _org_id: string }; Returns: undefined };
      transfer_ownership: {
        Args: { _new_owner: string; _org_id: string };
        Returns: undefined;
      };
      update_location: {
        Args: {
          _address: string;
          _hours: Json;
          _id: string;
          _name: string;
          _phone: string;
          _timezone: string;
        };
        Returns: undefined;
      };
      update_order_status: {
        Args: {
          _new_status: Database["public"]["Enums"]["order_status"];
          _order_id: string;
          _reason?: string;
        };
        Returns: undefined;
      };
      valid_location_hours: { Args: { _hours: Json }; Returns: boolean };
      write_audit: {
        Args: { _action: string; _meta: Json; _org: string; _target: string };
        Returns: undefined;
      };
    };
    Enums: {
      order_status: "new" | "confirmed" | "in_prep" | "ready" | "delivered" | "cancelled";
      order_type: "dine_in" | "takeout" | "delivery";
      org_role: "owner" | "manager" | "staff";
      platform_role: "platform_admin" | "support";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      order_status: ["new", "confirmed", "in_prep", "ready", "delivered", "cancelled"],
      order_type: ["dine_in", "takeout", "delivery"],
      org_role: ["owner", "manager", "staff"],
      platform_role: ["platform_admin", "support"],
    },
  },
} as const;
