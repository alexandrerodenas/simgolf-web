/**
 * SimGolf Web — Entry Point (Phaser)
 *
 * Stack : Vite + TypeScript + Phaser
 * Scènes : BootScene → GameScene
 */
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: document.body,
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, GameScene],
  fps: {
    target: 30,
    forceSetTimeOut: false,
  },
  render: {
    pixelArt: false,
    antialias: true,
  },
  input: {
    activePointers: 2, // pinch zoom
  },
};

new Phaser.Game(config);
