import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Default 1000ms is too short when SSE streams involve multiple Promise
// micro-task chains (each reader.read() is a separate await boundary).
configure({ asyncUtilTimeout: 5000 });
