import { Link, useNavigate } from "react-router-dom";
import "./Pagination.css";
import { useState } from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath: string;
  queryParams?: Record<string, string>;
}

const Pagination = ({ currentPage, totalPages, basePath, queryParams = {} }: PaginationProps) => {
  const navigate = useNavigate();
  const [jumpToPage, setJumpToPage] = useState("");

  // Don't render pagination if there's only one page
  if (totalPages <= 1) return null;

  // Calculate the range of page numbers to display
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  
  // Adjust startPage if we're near the end
  if (endPage === totalPages) {
    startPage = Math.max(1, endPage - 4);
  }
  
  // Generate the array of page numbers to display
  const pageNumbers = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i
  );

  // Build query string with all existing params plus page
  const buildQueryString = (page: number) => {
    const params = new URLSearchParams();
    // Add all existing query params
    Object.entries(queryParams).forEach(([key, value]) => {
      params.set(key, value);
    });
    // Set the page parameter
    params.set('page', String(page));
    return `?${params.toString()}`;
  };

  // Handle page jump
  const handlePageJump = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(jumpToPage, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      navigate(`${basePath}${buildQueryString(pageNum)}`);
      setJumpToPage("");
    }
  };

  return (
    <div className="pagination">
      <div className="pagination-controls">
        {/* Previous page button */}
        {currentPage > 1 && (
          <Link 
            to={`${basePath}${buildQueryString(currentPage - 1)}`}
            className="pagination-button"
          >
            &laquo; Prev
          </Link>
        )}

        {/* First page if not in range */}
        {startPage > 1 && (
          <>
            <Link to={`${basePath}${buildQueryString(1)}`} className="pagination-button">1</Link>
            {startPage > 2 && <span className="pagination-ellipsis">...</span>}
          </>
        )}

        {/* Page numbers */}
        {pageNumbers.map(pageNum => (
          <Link
            key={pageNum}
            to={`${basePath}${buildQueryString(pageNum)}`}
            className={`pagination-button ${pageNum === currentPage ? 'active' : ''}`}
          >
            {pageNum}
          </Link>
        ))}

        {/* Last page if not in range */}
        {endPage < totalPages && (
          <>
            {endPage < totalPages - 1 && <span className="pagination-ellipsis">...</span>}
            <Link to={`${basePath}${buildQueryString(totalPages)}`} className="pagination-button">
              {totalPages}
            </Link>
          </>
        )}

        {/* Next page button */}
        {currentPage < totalPages && (
          <Link
            to={`${basePath}${buildQueryString(currentPage + 1)}`}
            className="pagination-button"
          >
            Next &raquo;
          </Link>
        )}
      </div>
      
      {/* Jump to page form */}
      <div className="pagination-jump">
        <form onSubmit={handlePageJump}>
          <label>
            Go to page:
            <input
              type="text"
              value={jumpToPage}
              onChange={(e) => setJumpToPage(e.target.value)}
              className="pagination-jump-input"
              aria-label="Jump to page"
              pattern="[0-9]*"
            />
          </label>
          <button type="submit" className="pagination-jump-button">Go</button>
        </form>
      </div>
    </div>
  );
};

export default Pagination; 