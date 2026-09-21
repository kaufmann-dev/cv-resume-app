// Express 4 forwards synchronous exceptions, but async handlers need rejection forwarding.
export const asyncHandler = handler => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};
