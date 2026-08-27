import { describe, expect, it } from 'vitest';
import { ImageEditor } from './image-editor';

describe('ImageEditor color preset state', () => {
  it('shows the preset that matches the current color adjustments', () => {
    const editor = new ImageEditor();
    const vivid = editor.presets.find((preset) => preset.label === 'Rực rỡ')!;

    expect(editor.activePresetLabel()).toBe('Gốc');

    editor.applyPreset(vivid);

    expect(editor.activePresetLabel()).toBe('Rực rỡ');
    editor.ngOnDestroy();
  });

  it('switches to custom state after a manual adjustment no longer matches a preset', () => {
    const editor = new ImageEditor();
    const vivid = editor.presets.find((preset) => preset.label === 'Rực rỡ')!;
    editor.applyPreset(vivid);

    editor.setAdjustmentLive('brightness', 105);

    expect(editor.activePresetLabel()).toBeNull();
    editor.ngOnDestroy();
  });
});
