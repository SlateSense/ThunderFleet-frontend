import React from 'react';

const PlayerGrid = ({ grid }) => {
  return (
    <div className="grid">
      {grid.map((row, rowIndex) => (
        <div key={rowIndex} className="grid-row">
          {row.map((cell, colIndex) => (
            <div key={colIndex} className={`grid-cell ${cell}`}></div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default PlayerGrid;
