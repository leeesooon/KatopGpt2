import { useMemo } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import DocumentWorkspace from './components/DocumentWorkspace'
import PresentationWorkspace from './components/PresentationWorkspace'
import SettingsModal from './components/SettingsModal'
import AssistantProfileModal from './components/AssistantProfileModal'

export default function App() {
  const isWorkspaceWindow = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('workspaceWindow') === '1'
  }, [])
  const isPresentationWindow = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('presentationWindow') === '1'
  }, [])

  if (isWorkspaceWindow) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-surface-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.08),transparent_28%),radial-gradient(circle_at_75%_18%,rgba(14,165,233,0.08),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.94),rgba(2,6,23,1))]" />
        <div className="relative flex h-full w-full overflow-hidden p-2">
          <DocumentWorkspace standalone />
        </div>
      </div>
    )
  }

  if (isPresentationWindow) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-[#070b13]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(20,184,166,0.18),transparent_30%),radial-gradient(circle_at_92%_18%,rgba(248,113,113,0.12),transparent_24%),linear-gradient(180deg,rgba(7,11,19,0.98),rgba(2,6,23,1))]" />
        <div className="relative flex h-full w-full overflow-hidden p-2">
          <PresentationWorkspace standalone />
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-surface-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.08),transparent_28%),radial-gradient(circle_at_75%_18%,rgba(14,165,233,0.08),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.94),rgba(2,6,23,1))]" />
      <div className="relative flex h-full w-full flex-col overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <ChatView />
        <DocumentWorkspace />
        <PresentationWorkspace />
      </div>
      <SettingsModal />
      <AssistantProfileModal />
      </div>
    </div>
  )
}
