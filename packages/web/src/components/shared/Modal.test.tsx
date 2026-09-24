import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';

function Stacked() {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(true);
  return (
    <>
      <Modal open={outer} onClose={() => setOuter(false)} title="Outer form">
        <input aria-label="Draft" />
      </Modal>
      <Modal open={inner} onClose={() => setInner(false)} title="Inner dialog">
        <p>On top</p>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('closes only the top dialog on Escape', () => {
    render(<Stacked />);
    expect(screen.getByText('Outer form')).toBeTruthy();
    expect(screen.getByText('Inner dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Inner dialog')).toBeNull();
    expect(screen.getByText('Outer form')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Outer form')).toBeNull();
  });
});
