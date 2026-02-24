import { Mark } from '@tiptap/core';

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      commentMarkId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        'data-comment-id': HTMLAttributes.commentMarkId,
        class: 'withmd-comment-highlight',
      },
      0,
    ];
  },
});
