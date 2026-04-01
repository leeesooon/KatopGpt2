import { buildDocumentTaskPrompt } from './documentPromptBuilder'
import type { DocumentAgentMode, DocumentSelection, WorkspaceDocument } from '../types'

interface PrepareDocumentAgentRequestOptions {
  mode: DocumentAgentMode
  userPrompt: string
  document: WorkspaceDocument | null
  selection: DocumentSelection | null
}

export function prepareDocumentAgentRequest(options: PrepareDocumentAgentRequestOptions) {
  return buildDocumentTaskPrompt(options)
}
