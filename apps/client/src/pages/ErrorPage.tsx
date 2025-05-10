import { useRouteError, isRouteErrorResponse } from "react-router-dom";

const ErrorPage = () => {
  const error = useRouteError();
  
  let errorMessage = "Something went wrong!";
  let statusText = "Error";
  let status = "500";
  
  if (isRouteErrorResponse(error)) {
    errorMessage = error.data || error.statusText;
    statusText = error.statusText;
    status = String(error.status);
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <div className="error-container">
      <h1>Oops!</h1>
      <h2>{status} {statusText}</h2>
      <p>{errorMessage}</p>
      <p>
        <a href="/">Go back to homepage</a>
      </p>
    </div>
  );
};

export default ErrorPage; 