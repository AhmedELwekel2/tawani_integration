import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  dir?: 'rtl' | 'ltr';
}

/**
 * Headless TipTap editor constrained to bold/italic, headings (h2/h3),
 * bullet/ordered lists and links. Emits HTML via onChange; the parent
 * sanitizes with DOMPurify before persisting.
 */
const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, dir = 'ltr' }) => {
  const { t } = useTranslation();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { dir },
    },
  });

  // Sync external value changes (e.g. when switching which announcement is edited)
  useEffect(() => {
    if (editor && !editor.isFocused && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('announcements.editor.linkPrompt'), previousUrl || 'https://');
    if (url === null) return;
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div className="rte" dir={dir}>
      <div className="rte-toolbar" dir="ltr">
        <button
          type="button"
          className={editor.isActive('bold') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title={t('announcements.editor.bold')}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className={editor.isActive('italic') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title={t('announcements.editor.italic')}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title={t('announcements.editor.heading')}
        >
          H2
        </button>
        <button
          type="button"
          className={editor.isActive('heading', { level: 3 }) ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title={t('announcements.editor.heading')}
        >
          H3
        </button>
        <button
          type="button"
          className={editor.isActive('bulletList') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title={t('announcements.editor.bulletList')}
        >
          • ☰
        </button>
        <button
          type="button"
          className={editor.isActive('orderedList') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title={t('announcements.editor.orderedList')}
        >
          1. ☰
        </button>
        <button
          type="button"
          className={editor.isActive('link') ? 'active' : ''}
          onClick={setLink}
          title={t('announcements.editor.link')}
        >
          🔗
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};

export default RichTextEditor;
