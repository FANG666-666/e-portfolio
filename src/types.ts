export type Priority = 'low' | 'medium' | 'high'

export interface Todo {
  id: string
  text: string
  date: string // ISO yyyy-mm-dd
  done: boolean
  priority: Priority
}
