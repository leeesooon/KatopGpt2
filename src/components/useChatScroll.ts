import { useCallback, useEffect, useRef, useState } from 'react'

interface UseChatScrollOptions {
  activeConversationId: string | null
  latestMessageContent?: string
  messageCount: number
}

export function useChatScroll({ activeConversationId, latestMessageContent, messageCount }: UseChatScrollOptions) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number>(0)
  const scrollPositionsRef = useRef<Map<string, number>>(new Map())
  const prevConvIdRef = useRef<string | null>(null)
  const isRestoringScrollRef = useRef(false)
  const shouldAutoStickRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (scrollRafRef.current || isRestoringScrollRef.current) return
    scrollRafRef.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      if (container) {
        if (behavior === 'smooth') {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
        } else {
          container.scrollTop = container.scrollHeight
        }
      }
      scrollRafRef.current = 0
    })
  }, [])

  useEffect(() => {
    if (shouldAutoStickRef.current) {
      scrollToBottom('auto')
    }
  }, [messageCount, latestMessageContent, scrollToBottom])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const awayFromBottom = scrollHeight - scrollTop - clientHeight > 120
      shouldAutoStickRef.current = !awayFromBottom
      setShowScrollBottom(awayFromBottom)
      if (activeConversationId) {
        scrollPositionsRef.current.set(activeConversationId, scrollTop)
      }
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [activeConversationId])

  useEffect(() => {
    const prevId = prevConvIdRef.current
    prevConvIdRef.current = activeConversationId ?? null

    if (prevId === activeConversationId) return

    const container = scrollContainerRef.current
    if (!container || !activeConversationId) return

    isRestoringScrollRef.current = true

    requestAnimationFrame(() => {
      const savedPos = scrollPositionsRef.current.get(activeConversationId)
      if (savedPos != null) {
        container.scrollTop = savedPos
      } else {
        messagesEndRef.current?.scrollIntoView()
      }
      requestAnimationFrame(() => {
        isRestoringScrollRef.current = false
      })
    })
  }, [activeConversationId])

  const handleScrollToBottom = () => {
    shouldAutoStickRef.current = true
    scrollToBottom('smooth')
  }

  return {
    messagesEndRef,
    scrollContainerRef,
    showScrollBottom,
    handleScrollToBottom,
  }
}
