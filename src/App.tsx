import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import SettingsModal from './components/SettingsModal'

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-surface-950">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <ChatView />
      </div>
      <SettingsModal />
    </div>
  )
}
