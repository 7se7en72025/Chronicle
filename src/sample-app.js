'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STATE_RELATIVE_PATH = path.join('sample-app', 'state.json');

function resetSampleApp(worktree, fixtureState) {
  if (typeof worktree !== 'string' || !path.isAbsolute(worktree)) throw new TypeError('Sample app workspace must be an absolute path.');
  if (!fixtureState || fixtureState.schema !== 1 || fixtureState.appId !== 'chronicle-demo-issue-tracker' ||
      !Array.isArray(fixtureState.issues) || !fixtureState.documents || typeof fixtureState.documents !== 'object') {
    throw new TypeError('Unsupported sample app state fixture.');
  }
  let root;
  try { root = fs.realpathSync(worktree); }
  catch { throw new Error('Sample app workspace must already exist.'); }
  if (!fs.statSync(root).isDirectory()) throw new Error('Sample app workspace must be a directory.');
  const appDirectory = path.join(root, 'sample-app');
  const statePath = path.join(root, STATE_RELATIVE_PATH);
  const bytes = Buffer.from(JSON.stringify(fixtureState, null, 2) + '\n', 'utf8');
  let appDirectoryStat;
  try { appDirectoryStat = fs.lstatSync(appDirectory); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fs.mkdirSync(appDirectory);
    appDirectoryStat = fs.lstatSync(appDirectory);
  }
  if (!appDirectoryStat.isDirectory() || appDirectoryStat.isSymbolicLink()) throw new Error('Sample app state directory must not be redirected.');
  try {
    const stateStat = fs.lstatSync(statePath);
    if (!stateStat.isFile() || stateStat.isSymbolicLink()) throw new Error('Sample app state must be a regular file.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const tempPath = path.join(appDirectory, `.state-${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, statePath);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tempPath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    throw error;
  }
  return {
    appId: fixtureState.appId,
    statePath: STATE_RELATIVE_PATH.split(path.sep).join('/'),
    stateHash: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

module.exports = { resetSampleApp, STATE_RELATIVE_PATH };
