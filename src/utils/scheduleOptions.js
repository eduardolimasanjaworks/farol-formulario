export const createTimeOptions = (stepMinutes = 30) => {
  const options = [];
  for (let hour = 8; hour <= 20; hour += 1) {
    for (let min = 0; min < 60; min += stepMinutes) {
      const value = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      options.push(value);
    }
  }
  return options;
};
