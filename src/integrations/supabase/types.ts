export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      accounts: {
        Row: {
          archived_at: string | null;
          created_at: string;
          currency: string;
          id: string;
          initial_balance_cents: number;
          name: string;
          opened_on: string | null;
          space_id: string;
          type: Database["public"]["Enums"]["account_type"];
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          initial_balance_cents?: number;
          name: string;
          opened_on?: string | null;
          space_id: string;
          type?: Database["public"]["Enums"]["account_type"];
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          currency?: string;
          id?: string;
          initial_balance_cents?: number;
          name?: string;
          opened_on?: string | null;
          space_id?: string;
          type?: Database["public"]["Enums"]["account_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "accounts_space_id_fkey";
            columns: ["space_id"];
            isOneToOne: false;
            referencedRelation: "spaces";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["category_kind"] | null;
          name: string;
          parent_id: string | null;
          space_id: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["category_kind"] | null;
          name: string;
          parent_id?: string | null;
          space_id: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["category_kind"] | null;
          name?: string;
          parent_id?: string | null;
          space_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "categories_space_id_fkey";
            columns: ["space_id"];
            isOneToOne: false;
            referencedRelation: "spaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      space_invitations: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          invited_by: string;
          role: Database["public"]["Enums"]["space_role"];
          space_id: string;
          status: Database["public"]["Enums"]["invitation_status"];
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          invited_by: string;
          role?: Database["public"]["Enums"]["space_role"];
          space_id: string;
          status?: Database["public"]["Enums"]["invitation_status"];
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          invited_by?: string;
          role?: Database["public"]["Enums"]["space_role"];
          space_id?: string;
          status?: Database["public"]["Enums"]["invitation_status"];
        };
        Relationships: [
          {
            foreignKeyName: "space_invitations_space_id_fkey";
            columns: ["space_id"];
            isOneToOne: false;
            referencedRelation: "spaces";
            referencedColumns: ["id"];
          },
        ];
      };
      space_memberships: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["space_role"];
          space_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          role: Database["public"]["Enums"]["space_role"];
          space_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["space_role"];
          space_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "space_memberships_space_id_fkey";
            columns: ["space_id"];
            isOneToOne: false;
            referencedRelation: "spaces";
            referencedColumns: ["id"];
          },
        ];
      };
      spaces: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string;
          id: string;
          kind: Database["public"]["Enums"]["space_kind"];
          name: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          kind: Database["public"]["Enums"]["space_kind"];
          name: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["space_kind"];
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transaction_revisions: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string | null;
          id: number;
          new_row: Json | null;
          old_row: Json | null;
          space_id: string;
          transaction_id: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string | null;
          id?: number;
          new_row?: Json | null;
          old_row?: Json | null;
          space_id: string;
          transaction_id: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string | null;
          id?: number;
          new_row?: Json | null;
          old_row?: Json | null;
          space_id?: string;
          transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transaction_revisions_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      transactions: {
        Row: {
          account_id: string;
          amount_cents: number;
          category_id: string;
          created_at: string;
          created_by: string;
          deleted_at: string | null;
          description: string | null;
          direction: Database["public"]["Enums"]["tx_direction"];
          id: string;
          occurred_on: string;
          operation_type: Database["public"]["Enums"]["tx_operation"];
          space_id: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          amount_cents: number;
          category_id: string;
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          description?: string | null;
          direction: Database["public"]["Enums"]["tx_direction"];
          id?: string;
          occurred_on: string;
          operation_type?: Database["public"]["Enums"]["tx_operation"];
          space_id: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          amount_cents?: number;
          category_id?: string;
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          description?: string | null;
          direction?: Database["public"]["Enums"]["tx_direction"];
          id?: string;
          occurred_on?: string;
          operation_type?: Database["public"]["Enums"]["tx_operation"];
          space_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "account_balances";
            referencedColumns: ["account_id"];
          },
          {
            foreignKeyName: "transactions_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_space_id_fkey";
            columns: ["space_id"];
            isOneToOne: false;
            referencedRelation: "spaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      account_balances: {
        Row: {
          account_id: string | null;
          balance_cents: number | null;
          space_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "accounts_space_id_fkey";
            columns: ["space_id"];
            isOneToOne: false;
            referencedRelation: "spaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      accept_invitation: { Args: { _invitation: string }; Returns: string };
      category_root_kind: {
        Args: { _cat: string };
        Returns: Database["public"]["Enums"]["category_kind"];
      };
      create_shared_space: { Args: { _name: string }; Returns: string };
      create_starter_categories: {
        Args: { _space: string };
        Returns: undefined;
      };
      current_email: { Args: never; Returns: string };
      has_space_role: {
        Args: {
          _roles: Database["public"]["Enums"]["space_role"][];
          _space: string;
          _user: string;
        };
        Returns: boolean;
      };
      invite_to_space: {
        Args: {
          _email: string;
          _role?: Database["public"]["Enums"]["space_role"];
          _space: string;
        };
        Returns: string;
      };
      is_personal_space: { Args: { _space: string }; Returns: boolean };
      is_space_member: {
        Args: { _space: string; _user: string };
        Returns: boolean;
      };
      shares_shared_space: {
        Args: { _a: string; _b: string };
        Returns: boolean;
      };
    };
    Enums: {
      account_type: "checking" | "savings" | "card" | "cash" | "other";
      category_kind: "income" | "expense";
      invitation_status: "pending" | "accepted" | "revoked";
      space_kind: "personal" | "shared";
      space_role: "owner" | "member" | "viewer";
      tx_direction: "inflow" | "outflow";
      tx_operation: "ordinary";
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
      account_type: ["checking", "savings", "card", "cash", "other"],
      category_kind: ["income", "expense"],
      invitation_status: ["pending", "accepted", "revoked"],
      space_kind: ["personal", "shared"],
      space_role: ["owner", "member", "viewer"],
      tx_direction: ["inflow", "outflow"],
      tx_operation: ["ordinary"],
    },
  },
} as const;
