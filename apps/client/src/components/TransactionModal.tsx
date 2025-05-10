import { useEffect, useRef } from "react";
import "./TransactionModal.css";

interface TransactionModalProps {
  transaction: any;
  onClose: () => void;
}

const TransactionModal = ({ transaction, onClose }: TransactionModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // Format JSON with indentation for better readability
  const formattedJson = JSON.stringify(transaction, null, 2);

  // Close on ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Close when clicking outside the modal content
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  return (
    <div className="transaction-modal-overlay">
      <div className="transaction-modal-container" ref={modalRef}>
        <div className="transaction-modal-header">
          <h3>Transaction Details</h3>
          <button className="transaction-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="transaction-modal-content">
          <div className="transaction-json">
            <pre>{formattedJson}</pre>
          </div>
        </div>
        <div className="transaction-modal-footer">
          <button className="transaction-modal-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionModal; 