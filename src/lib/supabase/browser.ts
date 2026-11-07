"use client";
import { createBrowserClient } from "@supabase/ssr"; import type { Database } from "./database.types"; import { getSupabaseConfig } from "./env";
export function createClient() { const config = getSupabaseConfig(); if (!config) throw new Error("Supabase is not configured."); return createBrowserClient<Database>(config.url, config.key); }
