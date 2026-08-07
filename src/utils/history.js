'use strict';

const path = require('node:path');

const HISTORY_DIRECTORY_NAME = 'history';

function toHistoryDate(timestamp = new Date()) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Timestamp de historial no válido: ${timestamp}`);
  }

  return date.toISOString().slice(0, 10);
}

function sanitizeHistoryPart(value) {
  return String(value)
    .trim()
    .replace(/[^\p{L}\p{N}.-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'General';
}

function historyFolderName(station, action, timestamp = new Date()) {
  const stationNumber = String(station).replace(/^Estacion/i, '');
  if (!/^\d+$/.test(stationNumber)) {
    throw new TypeError(`Estación de historial no válida: ${station}`);
  }

  return `${toHistoryDate(timestamp)}_Estacion${stationNumber}_${sanitizeHistoryPart(action)}`;
}

function getHistoryDirectory(currentDirectory = process.cwd(), station, action, timestamp) {
  return path.join(
    currentDirectory,
    '.axetrules',
    HISTORY_DIRECTORY_NAME,
    historyFolderName(station, action, timestamp)
  );
}

function getHistoryFilePath(
  currentDirectory,
  station,
  action,
  fileName,
  timestamp
) {
  return path.join(
    getHistoryDirectory(currentDirectory, station, action, timestamp),
    fileName
  );
}

module.exports = {
  HISTORY_DIRECTORY_NAME,
  getHistoryDirectory,
  getHistoryFilePath,
  historyFolderName,
  sanitizeHistoryPart,
  toHistoryDate
};
