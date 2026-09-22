import type { OutLink } from '@bitacora/shared';
import { useMemo, type ComponentProps } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

/* eslint-disable @typescript-eslint/no-explicit-any */

const WIKILINK = /(!?)\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;

function titleKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convierte los [[wikilinks]] en enlaces y numera los checkboxes.
 * Trabaja sobre nodos de texto del arbol, asi que lo que esta dentro de un
 * bloque de codigo (que no es un nodo `text`) queda intacto solo.
 *
 * Es un "attacher" de unified: se pasa como tupla [plugin, opciones] y unified
 * lo invoca para obtener el transformador. No hay que llamarlo a mano.
 */
function remarkBitacora({ resolveTo }: { resolveTo: Map<string, string> }) {
  return (tree: any) => {
    let taskIndex = 0;

    const walk = (node: any) => {
      if (node.type === 'listItem' && typeof node.checked === 'boolean') {
        node.data = node.data ?? {};
        node.data.hProperties = { ...node.data.hProperties, 'data-task': String(taskIndex++) };
      }
      if (!Array.isArray(node.children)) return;

      const out: any[] = [];
      for (const child of node.children) {
        if (child.type !== 'text') {
          walk(child);
          out.push(child);
          continue;
        }

        const text: string = child.value;
        let last = 0;
        WIKILINK.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = WIKILINK.exec(text)) !== null) {
          if (match.index > last) out.push({ type: 'text', value: text.slice(last, match.index) });
          const target = match[2]!.trim();
          const label = match[3]?.trim() || target;
          const id = resolveTo.get(titleKey(target));
          out.push({
            type: 'link',
            url: id ? `/nota/${id}` : '',
            title: id ? null : 'Esta nota todavía no existe',
            data: { hProperties: { className: id ? 'wikilink' : 'wikilink unresolved' } },
            children: [{ type: 'text', value: label }]
          });
          last = match.index + match[0].length;
        }

        if (last === 0) out.push(child);
        else if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
      }
      node.children = out;
    };

    walk(tree);
  };
}

interface NoteMarkdownProps {
  body: string;
  outlinks: OutLink[];
  /** Pendientes en el mismo orden en que aparecen en el body. */
  onToggleTask?: (index: number, done: boolean) => void;
}

export function NoteMarkdown({ body, outlinks, onToggleTask }: NoteMarkdownProps) {
  // Estable entre renders: si cambia la referencia, react-markdown re-parsea todo.
  const resolveTo = useMemo(() => {
    const map = new Map<string, string>();
    for (const link of outlinks) {
      if (link.note) map.set(titleKey(link.targetTitle), link.note.id);
    }
    return map;
  }, [outlinks]);

  const plugins = useMemo(() => [remarkGfm, [remarkBitacora, { resolveTo }] as const], [resolveTo]);

  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={plugins as never}
        components={{
          a({ href, className, children, ...rest }: ComponentProps<'a'>) {
            if (className?.includes('unresolved')) {
              return (
                <span className={className} title="Esta nota todavía no existe">
                  {children}
                </span>
              );
            }
            if (href?.startsWith('/')) {
              return (
                <Link to={href} className={className ?? ''}>
                  {children}
                </Link>
              );
            }
            return (
              <a href={href} className={className} target="_blank" rel="noreferrer" {...rest}>
                {children}
              </a>
            );
          },
          li(props: any) {
            const task = props['data-task'];
            if (task === undefined || !onToggleTask) {
              const { node: _node, ...rest } = props;
              return <li {...rest} />;
            }
            const index = Number(task);
            // remark-gfm mete su propio <input disabled>; lo reemplazamos por uno vivo.
            const children = Array.isArray(props.children) ? props.children : [props.children];
            const checked = findCheckedState(children);
            return (
              <li className="task">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggleTask(index, event.target.checked)}
                />
                {children.filter((child: any) => !isCheckboxInput(child))}
              </li>
            );
          }
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}

function isCheckboxInput(child: any): boolean {
  return Boolean(child) && typeof child === 'object' && child.props?.type === 'checkbox';
}

function findCheckedState(children: any[]): boolean {
  for (const child of children) {
    if (isCheckboxInput(child)) return Boolean(child.props.checked);
  }
  return false;
}
