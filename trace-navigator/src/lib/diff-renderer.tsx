'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders markdown with special diff markers converted to styled components
 * Markers: ~~DELETED_START~~ ... ~~DELETED_END~~ and ~~INSERTED_START~~ ... ~~INSERTED_END~~
 */
export const DiffRenderer: React.FC<{ html: string; components?: any }> = ({ 
  html, 
  components = {} 
}) => {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let keyCounter = 0;
  
  // Match both DELETED and INSERTED markers
  const deletedRegex = /~~DELETED_START~~([\s\S]*?)~~DELETED_END~~/g;
  const insertedRegex = /~~INSERTED_START~~([\s\S]*?)~~INSERTED_END~~/g;
  
  // Combine both patterns
  const combinedRegex = /~~(DELETED|INSERTED)_START~~([\s\S]*?)~~\1_END~~/g;
  let match;
  
  while ((match = combinedRegex.exec(html)) !== null) {
    // Add markdown text before the marker
    if (match.index > lastIndex) {
      const markdownBefore = html.substring(lastIndex, match.index);
      if (markdownBefore.trim()) {
        parts.push(
          <ReactMarkdown 
            key={`md-${keyCounter++}`} 
            remarkPlugins={[remarkGfm]} 
            components={components}
          >
            {markdownBefore}
          </ReactMarkdown>
        );
      }
    }
    
    const [fullMatch, markerType, content] = match;
    if (markerType === 'DELETED') {
      parts.push(
        <span
          key={`del-${keyCounter++}`}
          style={{
            textDecoration: 'line-through',
            color: 'var(--diff-text)',
            backgroundColor: 'var(--diff-delete-bg)',
            padding: '0.125rem 0.375rem',
            borderRadius: '0.25rem',
            display: 'inline-block'
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={components}
          >
            {content}
          </ReactMarkdown>
        </span>
      );
    } else if (markerType === 'INSERTED') {
      parts.push(
        <span
          key={`ins-${keyCounter++}`}
          style={{
            color: 'var(--diff-text)',
            backgroundColor: 'var(--diff-insert-bg)',
            padding: '0.125rem 0.375rem',
            borderRadius: '0.25rem',
            fontWeight: 'bold',
            display: 'inline-block'
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={components}
          >
            {content}
          </ReactMarkdown>
        </span>
      );
    }
    
    lastIndex = match.index + fullMatch.length;
  }
  
  // Add remaining markdown text
  if (lastIndex < html.length) {
    const markdownAfter = html.substring(lastIndex);
    if (markdownAfter.trim()) {
      parts.push(
        <ReactMarkdown 
          key={`md-${keyCounter++}`} 
          remarkPlugins={[remarkGfm]} 
          components={components}
        >
          {markdownAfter}
        </ReactMarkdown>
      );
    }
  }
  
  return <>{parts}</>;
};

