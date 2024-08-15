import * as React from 'react';

import Container from './Container.js';

import {Counter} from './Counter.js';
import {Counter as Counter2} from './Counter2.js';
import AsyncModule from './cjs/Counter3.js';
const Counter3 = await(AsyncModule);

import ShowMore from './ShowMore.js';
import Button from './Button.js';
import Form from './Form.js';
import {Dynamic} from './Dynamic.js';
import {Client} from './Client.js';
import {TemporaryReferences} from './TemporaryReferences.js';

import {Note} from './cjs/Note.js';

import {like, greet, increment, returnElement} from './actions.js';

import {getServerState} from './ServerState.js';

const promisedText = new Promise(resolve =>
  setTimeout(() => resolve('deferred text'), 100)
);

export default async function App() {
  const res = await fetch('http://localhost:3001/todos');
  const todos = await res.json();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Flight</title>
      </head>
      <body>
        <Container>
          <h1>{getServerState()}</h1>
          <React.Suspense fallback={null}>
            <div data-testid="promise-as-a-child-test">
              Promise as a child hydrates without errors: {promisedText}
            </div>
          </React.Suspense>
          <Counter incrementAction={increment} />
          <Counter2 incrementAction={increment} />
          <Counter3 incrementAction={increment} />
          <ul>
            {todos.map(todo => (
              <li key={todo.id}>{todo.text}</li>
            ))}
          </ul>
          <ShowMore>
            <p>Lorem ipsum</p>
          </ShowMore>
          <Form action={greet} />
          <div>
            <Button action={like}>Like</Button>
          </div>
          <div>
            loaded statically: <Dynamic />
          </div>
          <Client />
          <Note />
          <TemporaryReferences action={returnElement} />
        </Container>
      </body>
    </html>
  );
}
