import { ActionError } from '../errors.mjs';
import { createCanvasActions } from './canvas.mjs';
import { createChannelActions } from './channels.mjs';
import { createFileActions } from './files.mjs';
import { createMessageActions } from './messages.mjs';
import { createUserActions } from './users.mjs';

export function createActions({ slack, cache, limits }) {
  const users = createUserActions({ slack, cache });
  const channels = createChannelActions({ slack, cache });
  const messages = createMessageActions({ slack, cache, users, channels });
  const canvas = createCanvasActions({ slack, users });
  const files = createFileActions({ slack, messages, limits });

  async function run(name, input) {
    switch (name) {
      case 'whoami': {
        const response = await slack.call('auth.test');
        return {
          user: response.user,
          user_id: response.user_id,
          team: response.team,
          team_id: response.team_id,
        };
      }
      case 'findUser':
        return users.find(input.query);
      case 'findChannel':
        return channels.find(input.query);
      case 'dm':
        return messages.dm(input);
      case 'post':
        return messages.post(input);
      case 'thread':
        return messages.thread(input);
      case 'readLink':
        return messages.readLink(input);
      case 'canvasCreate':
        return canvas.create(input);
      case 'canvasRead':
        return canvas.read(input);
      case 'canvasAppend':
        return canvas.append(input);
      case 'canvasEdit':
        return canvas.edit(input);
      case 'canvasComments':
        return canvas.comments(input);
      case 'canvasSections':
        return canvas.sections(input);
      case 'sendFile':
        return files.send(input);
      default:
        throw new ActionError('invalid_input', `Unknown action "${name}".`);
    }
  }

  return { run, messages, users, channels };
}
