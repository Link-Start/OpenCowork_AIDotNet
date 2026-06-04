import * as React from 'react'
import Markdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { Archive } from 'lucide-react'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import {
  getCompactSummaryDisplayText,
  isCompactSummaryLikeMessage
} from '@renderer/lib/agent/context-compression'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@renderer/lib/preview/viewers/markdown-components'

export function ContextCompressionMessage({
  message
}: {
  message: UnifiedMessage
}): React.JSX.Element | null {
  const { t } = useTranslation('agent')

  if (!isCompactSummaryLikeMessage(message)) {
    return null
  }

  const content = getCompactSummaryDisplayText(message).trim()
  if (!content) return null

  return (
    <div className="my-2 rounded-md border border-amber-500/25 bg-amber-500/6 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-amber-800 dark:text-amber-200">
          <Archive className="size-3.5" />
          {t('contextCompression.summaryTitle', {
            defaultValue: '\u4e0a\u4e0b\u6587\u538b\u7f29\u6458\u8981'
          })}
        </span>
      </div>
      <div className="mt-3 prose prose-sm max-w-none text-foreground dark:prose-invert [&_p]:my-2 [&_pre]:overflow-x-auto">
        <Markdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>
          {content}
        </Markdown>
      </div>
    </div>
  )
}
