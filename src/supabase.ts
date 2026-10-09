import { createClient } from '@supabase/supabase-js'

// Project URL + publishable (anon) key — safe to ship to the browser.
// Row-Level Security on the `todos` table allows anon CRUD.
const URL = 'https://sgcugveisaleusokhkvf.supabase.co'
const KEY = 'sb_publishable_rDLBa3Oi01n47OleQ3WY6Q_o1BHr0dN'

export const supabase = createClient(URL, KEY)

// Row shape in the `todos` table.
export interface TodoRow {
  id: number
  task: string
  date: string | null
  is_complete: boolean
  priority: string | null
  created_at: string
}
